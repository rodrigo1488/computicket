/**
 * Testes unitários da lógica pura do store de abas.
 * Rodar (Node >= 22.6, sem instalar nada):
 *   node --test src/components/tabs/tabs-store.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activateTab,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  createInitialState,
  getActiveTab,
  initState,
  moveTab,
  navigateInTab,
  openTab,
  parseHref,
  parseStoredState,
  reconcileWithUrl,
  serializeState,
  setTabSearch,
  tabHref,
  type TabsPolicy,
  type TabsState,
} from "./tabs-store.ts";

function makePolicy(overrides: Partial<TabsPolicy> = {}): TabsPolicy {
  let id = 0;
  let clock = 0;
  return {
    maxTabs: 4,
    reuseSearch: (p) => p === "/helpdesk" || p === "/dashboard",
    homePath: "/dashboard",
    makeId: () => `t${++id}`,
    now: () => ++clock,
    ...overrides,
  };
}

const paths = (s: TabsState) => s.tabs.map((t) => tabHref(t));

describe("parseHref", () => {
  it("separa caminho e query, remove hash e barra final", () => {
    assert.deepEqual(parseHref("/tickets/?status=aberto#x"), { pathname: "/tickets", search: "status=aberto" });
    assert.deepEqual(parseHref("https://app.local/ps?a=1"), { pathname: "/ps", search: "a=1" });
    assert.deepEqual(parseHref("/"), { pathname: "/", search: "" });
  });
});

describe("openTab / dedupe", () => {
  it("abre nova aba e ativa", () => {
    const p = makePolicy();
    const s0 = createInitialState("/dashboard", "", p);
    const r = openTab(s0, "/tickets", p);
    assert.equal(r.created, true);
    assert.equal(r.state.activeId, r.tabId);
    assert.deepEqual(paths(r.state), ["/dashboard", "/tickets"]);
  });

  it("reaproveita aba da mesma rota (sem duplicar)", () => {
    const p = makePolicy();
    let s = createInitialState("/dashboard", "", p);
    s = openTab(s, "/tickets", p).state;
    s = openTab(s, "/ps", p).state;
    const again = openTab(s, "/tickets", p);
    assert.equal(again.created, false);
    assert.equal(again.state.tabs.length, 3);
    assert.equal(getActiveTab(again.state).pathname, "/tickets");
  });

  it("forceNew cria duplicata", () => {
    const p = makePolicy();
    let s = createInitialState("/tickets", "", p);
    s = openTab(s, "/tickets", p, { forceNew: true }).state;
    assert.equal(s.tabs.length, 2);
  });

  it("link com query diferente abre aba distinta; mesma query reaproveita", () => {
    const p = makePolicy();
    const s = createInitialState("/tickets", "", p);
    const a = openTab(s, "/tickets?status=fechado", p);
    assert.equal(a.created, true);
    const b = openTab(a.state, "/tickets?status=fechado", p);
    assert.equal(b.created, false);
    assert.equal(b.tabId, a.tabId);
    // link sem query volta para a aba "limpa"
    const c = openTab(b.state, "/tickets", p);
    assert.equal(c.created, false);
    assert.equal(getActiveTab(c.state).search, "");
  });

  it("rotas reuseSearch atualizam a query da aba existente", () => {
    const p = makePolicy();
    const s = createInitialState("/helpdesk", "c=1", p);
    const r = openTab(s, "/helpdesk?c=2", p);
    assert.equal(r.created, false);
    assert.equal(getActiveTab(r.state).search, "c=2");
    assert.equal(r.state.tabs.length, 1);
  });

  it("opener é registrado e a aba nova entra logo após a de origem", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/a", "", p);
    s = openTab(s, "/b", p).state;
    s = activateTab(s, s.tabs[0].id, p);
    const r = openTab(s, "/c", p);
    assert.deepEqual(paths(r.state), ["/a", "/c", "/b"]);
    assert.equal(getActiveTab(r.state).openerId, s.tabs[0].id);
  });
});

describe("limite de abas", () => {
  it("descarta a inativa mais antiga ao passar do limite", () => {
    const p = makePolicy({ maxTabs: 3 });
    let s = createInitialState("/a", "", p);
    s = openTab(s, "/b", p).state;
    s = openTab(s, "/c", p).state;
    const r = openTab(s, "/d", p);
    assert.equal(r.created, true);
    assert.equal(r.state.tabs.length, 3);
    assert.deepEqual(r.evicted.map((t) => t.pathname), ["/a"]);
    assert.equal(getActiveTab(r.state).pathname, "/d");
  });

  it("não descarta abas protegidas (alterações não salvas) e rejeita se todas protegidas", () => {
    const p = makePolicy({ maxTabs: 3 });
    let s = createInitialState("/a", "", p);
    s = openTab(s, "/b", p).state;
    s = openTab(s, "/c", p).state;
    const protectedIds = new Set(s.tabs.map((t) => t.id));
    const r = openTab(s, "/d", p, { protectedIds });
    assert.equal(r.rejected, true);
    assert.equal(r.state, s);

    const r2 = openTab(s, "/d", p, { protectedIds: new Set([s.tabs[0].id]) });
    assert.equal(r2.rejected, false);
    assert.deepEqual(r2.evicted.map((t) => t.pathname), ["/b"]);
    assert.ok(r2.state.tabs.some((t) => t.pathname === "/a"));
  });
});

describe("closeTab", () => {
  it("fechar a ativa volta à aba de origem", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/a", "", p);
    s = openTab(s, "/b", p).state; // opener = a
    s = openTab(s, "/c", p).state; // opener = b
    const closed = closeTab(s, s.activeId, p);
    assert.equal(getActiveTab(closed).pathname, "/b");
  });

  it("sem opener ativa a vizinha da direita, senão da esquerda", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/a", "", p);
    s = openTab(s, "/b", p).state;
    s = openTab(s, "/c", p).state;
    s = { ...s, tabs: s.tabs.map((t) => ({ ...t, openerId: undefined })) };
    s = activateTab(s, s.tabs[1].id, p); // b
    const c1 = closeTab(s, s.activeId, p);
    assert.equal(getActiveTab(c1).pathname, "/c");
    const s2 = activateTab(c1, c1.tabs[1].id, p); // c (última)
    const c2 = closeTab(s2, s2.activeId, p);
    assert.equal(getActiveTab(c2).pathname, "/a");
  });

  it("fechar aba inativa mantém a ativa", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/a", "", p);
    s = openTab(s, "/b", p).state;
    const r = closeTab(s, s.tabs[0].id, p);
    assert.equal(r.tabs.length, 1);
    assert.equal(r.activeId, s.activeId);
  });

  it("nunca fica sem abas: a última vira o início (ou nada acontece se já for)", () => {
    const p = makePolicy();
    const s = createInitialState("/tickets", "", p);
    const r = closeTab(s, s.activeId, p);
    assert.deepEqual(paths(r), ["/dashboard"]);
    assert.equal(closeTab(r, r.activeId, p), r);
  });

  it("closeOtherTabs e closeAllTabs", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/dashboard", "", p);
    s = openTab(s, "/tickets", p).state;
    s = openTab(s, "/ps", p).state;
    const only = closeOtherTabs(s, s.tabs[1].id, p);
    assert.deepEqual(paths(only), ["/tickets"]);
    const all = closeAllTabs(s, p);
    assert.deepEqual(paths(all), ["/dashboard"]);
    const all2 = closeAllTabs(only, p);
    assert.deepEqual(paths(all2), ["/dashboard"]);
  });
});

describe("edição", () => {
  it("moveTab reordena", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/a", "", p);
    s = openTab(s, "/b", p).state;
    s = openTab(s, "/c", p).state;
    assert.deepEqual(paths(moveTab(s, s.tabs[2].id, 0)), ["/c", "/a", "/b"]);
  });

  it("navigateInTab: mesma rota troca query; rota nova morfa; rota existente mescla", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/orcamentos/novo", "", p);
    s = openTab(s, "/orcamentos", p).state;
    s = activateTab(s, s.tabs[0].id, p);
    const novoId = s.tabs[0].id;

    const q = navigateInTab(s, novoId, "/orcamentos/novo?ia=1", p);
    assert.equal(q.state.tabs[0].search, "ia=1");

    const morph = navigateInTab(s, novoId, "/orcamentos/5", p);
    assert.equal(morph.state.tabs.length, 2);
    assert.equal(morph.state.tabs[0].pathname, "/orcamentos/5");
    assert.equal(morph.state.tabs[0].id, novoId);

    const merge = navigateInTab(s, novoId, "/orcamentos", p);
    assert.equal(merge.closedId, novoId);
    assert.deepEqual(paths(merge.state), ["/orcamentos"]);
    assert.equal(merge.state.activeId, merge.activeId);
  });

  it("setTabSearch é no-op quando igual", () => {
    const p = makePolicy();
    const s = createInitialState("/a", "x=1", p);
    assert.equal(setTabSearch(s, s.activeId, "?x=1"), s);
  });
});

describe("reconcileWithUrl (Voltar/Avançar, deep link)", () => {
  it("ativa a aba existente da rota", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/a", "", p);
    s = openTab(s, "/b", p).state;
    const r = reconcileWithUrl(s, "/a", "", p);
    assert.equal(getActiveTab(r.state).pathname, "/a");
    assert.equal(r.state.tabs.length, 2);
  });

  it("cria aba para rota desconhecida", () => {
    const p = makePolicy({ maxTabs: 10 });
    const s = createInitialState("/a", "", p);
    const r = reconcileWithUrl(s, "/tickets/9", "", p);
    assert.equal(r.state.tabs.length, 2);
    assert.equal(getActiveTab(r.state).pathname, "/tickets/9");
  });

  it("na aba ativa só atualiza a query", () => {
    const p = makePolicy();
    const s = createInitialState("/tickets", "", p);
    const r = reconcileWithUrl(s, "/tickets", "status=fechado", p);
    assert.equal(r.state.tabs.length, 1);
    assert.equal(getActiveTab(r.state).search, "status=fechado");
  });
});

describe("persistência", () => {
  it("serializa e restaura; deep link ativa a aba correspondente", () => {
    const p = makePolicy({ maxTabs: 10 });
    let s = createInitialState("/dashboard", "", p);
    s = openTab(s, "/tickets/3", p, { title: "Ticket #3" }).state;
    const stored = parseStoredState(serializeState(s));
    assert.ok(stored);
    assert.deepEqual(stored, s);
    const restored = initState(stored, "/dashboard", "", p);
    assert.equal(getActiveTab(restored).pathname, "/dashboard");
    assert.equal(restored.tabs.length, 2);
    assert.equal(restored.tabs[1].title, "Ticket #3");
  });

  it("F5 em URL fora do estado salvo cria aba", () => {
    const p = makePolicy({ maxTabs: 10 });
    const s = createInitialState("/dashboard", "", p);
    const restored = initState(s, "/ps", "", p);
    assert.deepEqual(paths(restored), ["/dashboard", "/ps"]);
  });

  it("sem estado salvo cria a aba inicial a partir da URL", () => {
    const p = makePolicy();
    const s = initState(null, "/ps", "q=1", p);
    assert.deepEqual(paths(s), ["/ps?q=1"]);
  });

  it("ignora dados corrompidos, versão errada e ids duplicados", () => {
    assert.equal(parseStoredState(null), null);
    assert.equal(parseStoredState("{oops"), null);
    assert.equal(parseStoredState(JSON.stringify({ v: 999, tabs: [], activeId: "x" })), null);
    const dup = parseStoredState(
      JSON.stringify({
        v: 1,
        activeId: "nao-existe",
        tabs: [
          { id: "a", pathname: "/a", search: "", lastActiveAt: 1, openerId: "fantasma" },
          { id: "a", pathname: "/dup", search: "", lastActiveAt: 2 },
          { id: "b", pathname: "sem-barra", search: "", lastActiveAt: 3 },
        ],
      }),
    );
    assert.ok(dup);
    assert.equal(dup.tabs.length, 1);
    assert.equal(dup.activeId, "a");
    assert.equal(dup.tabs[0].openerId, undefined);
  });

  it("respeita o limite de abas ao restaurar", () => {
    const tabs = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, pathname: `/p${i}`, search: "", lastActiveAt: i }));
    const s = parseStoredState(JSON.stringify({ v: 1, activeId: "x0", tabs }), 5);
    assert.equal(s?.tabs.length, 5);
  });
});
