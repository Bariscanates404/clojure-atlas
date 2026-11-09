(ns web.reitit-app
  (:require [reitit.ring :as ring]
            [web.handlers :as h]))

(def routes
  [["/ping" h/health]
   ["/" ["/home" {:get h/health}]]
   ["/api" {:middleware [h/wrap-log]}
    ["/items" {:middleware [[h/wrap-auth :admin]]
               :get h/list-items
               :post {:handler h/create-item :middleware [h/wrap-log]}}]]])

(def app (ring/ring-handler (ring/router routes)))
