import unittest
from datetime import datetime, timedelta, timezone

from flask import Flask

from app import db
from app.blueprints.dashboard import (
    _brasilia_day_key,
    _build_comparativo_por_dia,
    _counts_from_day_events,
    _engine_closed_conversation_events,
    _helpdesk_tickets_created_by_day,
    _rating_closed_conversation_events,
)
from app.models import HelpDeskRating, HelpDeskTicketLink, Ticket, User
from app.timezone_utils import brasilia_to_utc, get_brasilia_now


class HelpdeskDashboardComparativoTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            SECRET_KEY="test-secret",
            TESTING=True,
        )
        db.init_app(self.app)
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        user = User(name="Agente", email="agente@example.invalid", password_hash="x")
        db.session.add(user)
        db.session.flush()
        self.user_id = user.id
        self.now = get_brasilia_now()
        self.month_start = self.now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        self.day_end = self.now.replace(hour=23, minute=59, second=59, microsecond=999999)

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def _ticket(self, status="aberto", created_at=None, closed_at=None):
        ticket = Ticket(
            title="Atendimento Help Desk",
            status=status,
            opened_by_id=self.user_id,
            created_at=created_at or brasilia_to_utc(self.now).replace(tzinfo=None),
            closed_at=closed_at,
        )
        db.session.add(ticket)
        db.session.flush()
        return ticket

    def _link(self, ticket, engine_ticket_id, created_at=None):
        row = HelpDeskTicketLink(
            engine_ticket_id=engine_ticket_id,
            computicket_ticket_id=ticket.id,
            created_at=created_at or ticket.created_at,
        )
        db.session.add(row)
        db.session.flush()
        return row

    def test_brasilia_day_key_converts_utc_evening_to_same_local_day(self):
        # 23:00 BRT = 02:00 UTC do dia seguinte
        utc = datetime(2026, 8, 15, 2, 0, tzinfo=timezone.utc)
        self.assertEqual(_brasilia_day_key(utc), "2026-08-14")
        self.assertEqual(_brasilia_day_key("2026-08-15T02:00:00.000Z"), "2026-08-14")

    def test_open_linked_ticket_counts_on_created_day(self):
        created_local = self.now.replace(hour=10, minute=0, second=0, microsecond=0)
        created = brasilia_to_utc(created_local)
        ticket = self._ticket("aberto", created_at=created.replace(tzinfo=None))
        self._link(ticket, engine_ticket_id=501)
        db.session.commit()

        counts = _helpdesk_tickets_created_by_day(self.month_start, self.day_end)
        self.assertEqual(counts.get(created_local.date().isoformat()), 1)
        self.assertEqual(sum(counts.values()), 1)

    def test_unlinked_or_closed_without_link_are_not_tickets_series(self):
        created = brasilia_to_utc(self.now.replace(hour=10, minute=0, second=0, microsecond=0))
        self._ticket("aberto", created_at=created.replace(tzinfo=None))
        self._ticket(
            "fechado",
            created_at=created.replace(tzinfo=None),
            closed_at=created.replace(tzinfo=None),
        )
        db.session.commit()

        counts = _helpdesk_tickets_created_by_day(self.month_start, self.day_end)
        self.assertEqual(counts, {})

    def test_linked_existing_ticket_counts_on_link_day(self):
        last_month = brasilia_to_utc(
            (self.month_start - timedelta(days=5)).replace(hour=12, minute=0, second=0, microsecond=0)
        )
        ticket = self._ticket("em_andamento", created_at=last_month.replace(tzinfo=None))
        linked_local = self.now.replace(hour=15, minute=0, second=0, microsecond=0)
        linked = brasilia_to_utc(linked_local)
        self._link(ticket, engine_ticket_id=777, created_at=linked.replace(tzinfo=None))
        db.session.commit()

        counts = _helpdesk_tickets_created_by_day(self.month_start, self.day_end)
        self.assertEqual(counts.get(linked_local.date().isoformat()), 1)

    def test_ratings_survive_engine_reopen(self):
        requested_local = self.now.replace(hour=18, minute=0, second=0, microsecond=0)
        requested = brasilia_to_utc(requested_local)
        day_key = requested_local.date().isoformat()
        db.session.add(
            HelpDeskRating(
                engine_ticket_id=88,
                token="tok-88",
                requested_at=requested.replace(tzinfo=None),
                sent_at=requested.replace(tzinfo=None),
            )
        )
        db.session.commit()

        events = _rating_closed_conversation_events(self.month_start, self.day_end)
        self.assertIn((88, day_key), events)

        def empty_closed(_method, _path, params=None):
            return {"tickets": [], "hasMore": False, "count": 0}

        engine_events = _engine_closed_conversation_events(
            empty_closed, self.month_start.date(), self.now.date()
        )
        merged = _counts_from_day_events(
            events | engine_events,
            self.month_start.date().isoformat(),
            self.now.date().isoformat(),
        )
        self.assertEqual(merged.get(day_key), 1)

    def test_engine_and_rating_same_conversation_dedupe(self):
        requested_local = self.now.replace(hour=18, minute=0, second=0, microsecond=0)
        requested = brasilia_to_utc(requested_local)
        day_key = requested_local.date().isoformat()
        db.session.add(
            HelpDeskRating(
                engine_ticket_id=12,
                token="tok-12",
                requested_at=requested.replace(tzinfo=None),
            )
        )
        db.session.commit()

        def still_closed(_method, _path, params=None):
            return {
                "tickets": [{"id": 12, "updatedAt": requested.isoformat().replace("+00:00", "Z"), "status": "closed"}],
                "hasMore": False,
            }

        events = _engine_closed_conversation_events(
            still_closed, self.month_start.date(), self.now.date()
        )
        events |= _rating_closed_conversation_events(self.month_start, self.day_end)
        merged = _counts_from_day_events(
            events,
            self.month_start.date().isoformat(),
            self.now.date().isoformat(),
        )
        self.assertEqual(merged.get(day_key), 1)

    def test_comparativo_keeps_same_series_keys(self):
        day1 = self.month_start.date()
        day2 = day1 + timedelta(days=1)
        last = self.month_start.replace(hour=12, minute=0, second=0, microsecond=0) + timedelta(days=1)
        series = _build_comparativo_por_dia(
            self.month_start,
            last,
            {day1.isoformat(): 4},
            {day1.isoformat(): 2, day2.isoformat(): 1},
        )
        self.assertEqual(series[0], {"date": day1.isoformat(), "conversas": 4, "tickets": 2})
        self.assertEqual(series[1], {"date": day2.isoformat(), "conversas": 0, "tickets": 1})


if __name__ == "__main__":
    unittest.main()
