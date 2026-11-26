/**
 * Testes unitários da lógica pura de paginação e mesclagem de mensagens do Help Desk.
 * Rodar (Node >= 22.6):
 *   node --test src/lib/helpdeskMessages.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeOlderMessagesPage,
  retainOptimisticMessages,
  sortMessagesChronologically,
} from "./helpdeskMessages.ts";

type Msg = {
  id: string;
  body?: string;
  fromMe?: boolean;
  createdAt?: string;
  ack?: number;
  isEdited?: boolean;
  isDeleted?: boolean;
  isInternal?: boolean;
};

function makeMsg(id: string, minuteOffset: number, extra: Partial<Msg> = {}): Msg {
  const ts = new Date(Date.UTC(2026, 0, 1, 12, minuteOffset, 0)).toISOString();
  return { id, body: `msg-${id}`, fromMe: false, createdAt: ts, ...extra };
}

describe("mergeOlderMessagesPage", () => {
  it("anexa mensagens mais antigas no topo em ordem cronológica sem duplicar sobreposição de offset", () => {
    const page1 = [makeMsg("21", 21), makeMsg("22", 22), makeMsg("23", 23)];
    // Simula deslocamento de offset: id "21" aparece de novo na página 2
    const page2 = [makeMsg("19", 19), makeMsg("20", 20), makeMsg("21", 21, { body: "versao-antiga" })];

    const merged = mergeOlderMessagesPage(page1, page2);

    assert.deepEqual(
      merged.map((m) => m.id),
      ["19", "20", "21", "22", "23"],
    );
    // Preserva a versão mais atual que já estava no thread para o id sobreposto
    assert.equal(merged.find((m) => m.id === "21")?.body, "msg-21");
  });

  it("lida com lista anterior vazia ou indefinida", () => {
    const page2 = [makeMsg("2", 2), makeMsg("1", 1)];
    const merged = mergeOlderMessagesPage(undefined, page2);
    assert.deepEqual(
      merged.map((m) => m.id),
      ["1", "2"],
    );
  });
});

describe("retainOptimisticMessages", () => {
  it("descarta mensagens fora da janela da página 1 quando preserveOlder é falso", () => {
    const previous = [makeMsg("1", 1), makeMsg("2", 2), makeMsg("3", 3)];
    const page1 = [makeMsg("2", 2), makeMsg("3", 3), makeMsg("4", 4)];

    const result = retainOptimisticMessages(page1, previous);

    assert.deepEqual(
      result.map((m) => m.id),
      ["2", "3", "4"],
    );
  });

  it("preserva páginas antigas já carregadas quando preserveOlder é verdadeiro durante polling", () => {
    const previous = [makeMsg("1", 1), makeMsg("2", 2), makeMsg("3", 3), makeMsg("4", 4)];
    // Polling traz apenas a página 1 (últimas 3 mensagens) com nova mensagem "5" e edição em "4"
    const page1 = [
      makeMsg("3", 3),
      makeMsg("4", 4, { body: "msg-4-editada", isEdited: true, ack: 3 }),
      makeMsg("5", 5),
    ];

    const result = retainOptimisticMessages(page1, previous, { preserveOlder: true });

    assert.deepEqual(
      result.map((m) => m.id),
      ["1", "2", "3", "4", "5"],
    );
    assert.equal(result.find((m) => m.id === "4")?.body, "msg-4-editada");
    assert.equal(result.find((m) => m.id === "4")?.isEdited, true);
  });

  it("mantém placeholders temp- pendentes e remove quando reconciliados na página 1", () => {
    const previous = [
      makeMsg("1", 1),
      makeMsg("temp-1", 10, { fromMe: true, body: "enviando" }),
      makeMsg("temp-2", 11, { fromMe: true, body: "ainda-nao-persistida" }),
    ];
    const page1 = [
      makeMsg("10", 10, { fromMe: true, body: "enviando" }),
    ];

    const result = retainOptimisticMessages(page1, previous, { preserveOlder: true });

    assert.deepEqual(
      result.map((m) => m.id),
      ["1", "10", "temp-2"],
    );
  });

  it("mantém ordenação cronológica estável mesmo com entrada fora de ordem", () => {
    const sorted = sortMessagesChronologically([makeMsg("3", 3), makeMsg("1", 1), makeMsg("2", 2)]);
    assert.deepEqual(
      sorted.map((m) => m.id),
      ["1", "2", "3"],
    );
  });
});
