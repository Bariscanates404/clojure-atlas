(ns app.alpha
  (:require [re-frame.alpha :refer [reg-event-db dispatch]]))

(defn remove-item [db [_ id]] (dissoc db id))

(reg-event-db :remove-item remove-item)

(defn button [id] [:button {:on-click #(dispatch [:remove-item id])}])
