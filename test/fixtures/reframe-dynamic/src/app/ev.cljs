(ns app.ev
  (:require [re-frame.core :as rf]))

(rf/reg-event-db ::saved (fn [db _] db))

(rf/reg-event-db ::never-dynamic (fn [db _] db))

(defn go [ev] (rf/dispatch [ev]))

(defn go-whole [event-vector] (rf/dispatch-sync event-vector))

(defn from-literal [] (go ::saved))

(defn plain [] (rf/dispatch [::never-dynamic]))
