import {
  shouldSendConnectionGreeting,
  shouldSendOutOfHoursMessage,
  tryClaimAutoMessageOnce,
  tryClaimConnectionGreeting,
  tryClaimOutOfHours
} from "../connectionGreetingLimit";
import Ticket from "../../models/Ticket";

jest.mock("../../models/Ticket", () => ({
  __esModule: true,
  default: { update: jest.fn() }
}));

const mockedUpdate = Ticket.update as jest.Mock;

const ticket = {
  id: 42,
  companyId: 1,
  sessionStartedAt: new Date("2026-09-14T08:00:00.000Z"),
  lastGreetingSentAt: null as Date | null
};

describe("tryClaimAutoMessageOnce", () => {
  beforeEach(() => {
    mockedUpdate.mockReset();
  });

  it("permite o primeiro disparo de saudação", async () => {
    mockedUpdate.mockResolvedValue([1]);

    await expect(tryClaimAutoMessageOnce(ticket, "greeting")).resolves.toBe(
      true
    );
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate.mock.calls[0][0]).toHaveProperty("lastGreetingSentAt");
  });

  it("bloqueia disparo repetido de saudação", async () => {
    mockedUpdate.mockResolvedValue([0]);

    await expect(tryClaimConnectionGreeting(ticket)).resolves.toBe(false);
  });

  it("permite o primeiro disparo fora do expediente", async () => {
    mockedUpdate.mockResolvedValue([1]);

    await expect(tryClaimOutOfHours(ticket)).resolves.toBe(true);
    expect(mockedUpdate.mock.calls[0][0]).toHaveProperty(
      "lastOutOfHoursSentAt"
    );
  });

  it("bloqueia disparo repetido fora do expediente", async () => {
    mockedUpdate.mockResolvedValue([0]);

    await expect(shouldSendOutOfHoursMessage(ticket)).resolves.toBe(false);
  });

  it("serializa dois claims da mesma mensagem: só o primeiro vence", async () => {
    mockedUpdate.mockResolvedValueOnce([1]).mockResolvedValueOnce([0]);

    const [first, second] = await Promise.all([
      shouldSendConnectionGreeting(ticket),
      shouldSendConnectionGreeting(ticket)
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("permite saudação e fora do expediente de forma independente", async () => {
    mockedUpdate.mockResolvedValue([1]);

    await expect(shouldSendConnectionGreeting(ticket)).resolves.toBe(true);
    await expect(shouldSendOutOfHoursMessage(ticket)).resolves.toBe(true);
  });
});
