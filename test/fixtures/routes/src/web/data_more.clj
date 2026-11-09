(ns web.data-more
  (:require [reitit.http :as http]
            [reitit.ring :as ring]
            [io.pedestal.http.route :as route]
            [web.more-handlers :as h]))

(def users
  ["/users" {:get {:handler (h/list-users h/db)}}])

(def api ["/api" users])

(def r2 (http/router [["/a" {:get {:handler h/show}}]
                      ["/b" {:post {:handler h/other}}]]
                     {:data {:interceptors [h/auth-ic]}}))

(def dup1 ["/x" {:get {:handler h/show}}])
(def dup2 ["/x" {:get {:handler h/other}}])
(def r3 (ring/router [dup1 dup2]))

(def r4 (ring/router ["/m" {:get {:handler h/show :middleware [(h/mw 1)]}}]))

(def table
  (route/expand-routes
   #{["/pu/:id" :get [h/auth-ic (fn [req] (h/real-handler req))] :route-name :user]
     ["/pu/:id/profile" :get h/profile :route-name :prof]}))
