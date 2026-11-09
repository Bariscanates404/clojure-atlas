(ns app.events
  (:require [re-frame.core :as rf]))

(rf/reg-event-db ::save
  (fn [db [_ x]]
    (rf/dispatch [::saved x])
    (assoc db :x x)))

(defn on-saved [db _] db)

(rf/reg-event-fx ::saved on-saved)

(rf/reg-sub ::items (fn [db] (:items db)))

(rf/reg-sub ::count :<- [::items] (fn [items] (count items)))

(defn view []
  [:div @(rf/subscribe [::count])
   [:button {:on-click #(rf/dispatch [::save 1])}]
   [:a {:on-click #(rf/dispatch [::unknown])}]])
