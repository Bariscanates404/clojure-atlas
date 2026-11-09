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
