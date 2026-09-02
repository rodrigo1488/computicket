import unittest

from app.blueprints.internal_chat import (
	_normalize_chat,
	_normalize_message,
	_rewrite_media_url,
	_user_ids_from_payload,
)


class InternalChatNormalizeTest(unittest.TestCase):
	def test_rewrite_chat_media_path(self):
		self.assertEqual(
			_rewrite_media_url("chat-media/123.jpg"),
			"/flask/internal-chat/api/media/chat-media/123.jpg",
		)
		self.assertEqual(
			_rewrite_media_url("http://whatsapp-engine:4000/public/chat-media/a.png"),
			"/flask/internal-chat/api/media/chat-media/a.png",
		)

	def test_dm_title_uses_the_other_participant(self):
		chat = _normalize_chat(
			{
				"id": 9,
				"title": "Alice",
				"isGroup": False,
				"ownerId": 1,
				"lastMessage": "Oi",
				"users": [
					{"userId": 1, "unreads": 0, "user": {"id": 1, "name": "Alice"}},
					{"userId": 2, "unreads": 3, "user": {"id": 2, "name": "Bruno"}},
				],
			},
			engine_user_id=2,
		)
		self.assertEqual(chat["title"], "Alice")
		self.assertEqual(chat["unreads"], 3)
		self.assertEqual(chat["peer"]["name"], "Alice")
		self.assertFalse(chat["isGroup"])

	def test_group_keeps_title_and_participants(self):
		chat = _normalize_chat(
			{
				"id": 4,
				"title": "Plantão",
				"isGroup": True,
				"ownerId": 1,
				"users": [
					{"userId": 1, "unreads": 1, "user": {"id": 1, "name": "Alice"}},
					{"userId": 2, "unreads": 0, "user": {"id": 2, "name": "Bruno"}},
				],
			},
			engine_user_id=1,
		)
		self.assertEqual(chat["title"], "Plantão")
		self.assertEqual(chat["unreads"], 1)
		self.assertEqual(len(chat["participants"]), 2)

	def test_message_marks_mine_and_rewrites_media(self):
		msg = _normalize_message(
			{
				"id": 11,
				"chatId": 4,
				"senderId": 2,
				"message": "",
				"mediaPath": "chat-media/doc.pdf",
				"mediaName": "doc.pdf",
				"sender": {"id": 2, "name": "Bruno"},
			},
			engine_user_id=2,
		)
		self.assertTrue(msg["mine"])
		self.assertEqual(msg["mediaUrl"], "/flask/internal-chat/api/media/chat-media/doc.pdf")

	def test_user_ids_from_payload(self):
		users = _user_ids_from_payload({"users": [{"engine_user_id": 8}, {"id": 8}, 9, "x"]})
		self.assertEqual(users, [{"id": 8}, {"id": 9}])
