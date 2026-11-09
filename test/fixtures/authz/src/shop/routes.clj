(ns shop.routes
  (:require [reitit.ring :as ring]
            [shop.auth :as auth]
            [shop.handlers :as h]))

(defn order-routes []
  ["/orders"
   ["" {:get {:handler (h/collect h/list-orders)
              :authz {:permission #{:read-orders :admin} :tenant auth/tenant-of}}}]
   ["/:id" {:delete {:handler h/delete-order
                     :authz {:permission [:write-orders :audit]}}}]])

(defn report-routes [perm]
  ["/reports" {:middleware [[auth/wrap-permission :read-reports]]
               :get {:handler h/report :authz {:permission perm}}}])

(def admin-routes ["/admin" {:get h/report}])

(defn app []
  (ring/router
    [["/health" {:authz {:exempt "load balancer probe"}} ["" {:get h/health}]]
     ["/api" {:middleware [auth/wrap-session]}
      (order-routes)
      (when true (report-routes :x))]]
    {:data {:middleware [auth/wrap-session]}}))
