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

(def std-interceptors [rf/trim-v])

(defn handle-stamp [db _] db)

(rf/reg-event-db ::stamp std-interceptors handle-stamp)

(rf/reg-event-db ::same (fn [db _] (rf/dispatch [::saved]) db))

(rf/reg-sub ::same (fn [db _] (:same db)))
