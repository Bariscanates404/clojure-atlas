(ns shop.exports
  (:require [reitit.ring]
            [shop.handlers :as h]
            [shop.permissions :as p]))

(def ^:private permission-of p/route->permission)

(defn- export-authz [route tenant]
  {:permission (permission-of route) :tenant tenant})

(defn export-routes []
  [["/orders.csv" {:get {:handler h/report :authz (export-authz "/orders.csv" :order)}}]
   ["/audit.log" {:get {:handler h/report :authz (export-authz "/audit.log" :order)}}]
   ["/invoice" {:get {:handler h/report :authz {:permission (get p/by-key :invoice)}}}]
   ["/receipt" {:get {:handler h/report :authz {:permission (:invoice p/by-key)}}}]
   ["/unlisted" {:get {:handler h/report :authz (export-authz "/no-such-route" :order)}}]])
