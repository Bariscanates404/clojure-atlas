// re-frame events read from small inline sources.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { edgeRows, graphOf } from './helpers/inline-graph.ts';

describe('effect maps', () => {
  it('reads the events of :dispatch-n and :dispatch-later as dispatches', async () => {
    const doc = await graphOf({
      'src/app/events.cljs': `(ns app.events (:require [re-frame.core :as rf]))
(rf/reg-event-db :app/init (fn [db _] db))
(rf/reg-event-db :app/n1 (fn [db _] db))
(rf/reg-event-db :app/later (fn [db _] db))
(rf/reg-event-fx :app/load
  (fn [_ _] {:dispatch [:app/init] :dispatch-n [[:app/n1] nil (when false [:app/none])] :dispatch-later [{:ms 10 :dispatch [:app/later]}]}))
`,
    });
    assert.deepEqual(edgeRows(doc, 'dispatches'), [
      'handler:event :app/load src/app/events.cljs:5 -> event::app/init static_proven',
      'handler:event :app/load src/app/events.cljs:5 -> event::app/later heuristic',
      'handler:event :app/load src/app/events.cljs:5 -> event::app/n1 heuristic',
    ]);
  });
});

describe('dispatches whose event id is not a literal', () => {
  it('are recorded as UNKNOWN sites and event_flow says any event may be dispatched there', async () => {
    const { buildFixture } = await import('./helpers/atlas-fixture.ts');
    const { graphFromJson } = await import('../src/mcp/graph.ts');
    const { eventFlow } = await import('../src/mcp/queries.ts');
    const g = graphFromJson(JSON.stringify(await buildFixture('reframe-dynamic')));
    const saved = eventFlow(g, ':app.ev/saved');
    assert.match(saved.verdict, /dispatched from 0 site\(s\)/);
    assert.match(saved.verdict, /2 dispatch site\(s\) with a non-literal event id may also dispatch it/);
    assert.ok(saved.notes.some((n) => /2 dispatch site\(s\) with a non-literal event id may also dispatch it/.test(n)));
    const sites = saved.sections.find((s) => s.short === 'dispatch sites with a non-literal event id');
    assert.deepEqual(sites?.rows.map((r) => [r.label, r.band, r.line]), [['app.ev/go', 'unknown', 8], ['app.ev/go-whole', 'unknown', 10]]);
    const quiet = eventFlow(g, ':app.ev/never-dynamic');
    assert.match(quiet.verdict, /2 dispatch site\(s\) with a non-literal event id may also dispatch it/);
  });
});
