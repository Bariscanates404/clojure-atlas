(ns app.shared
  (:require [re-frame.core :as rf]))

(rf/reg-event-db ::reset (fn [_ _] {}))
