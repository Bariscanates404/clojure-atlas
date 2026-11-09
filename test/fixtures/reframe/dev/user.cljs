(ns user
  (:require [re-frame.core :as rf]))

(defn go [] (rf/dispatch [:app.events/save 2]))
