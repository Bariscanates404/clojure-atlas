(ns server.api
  (:require [reitit.ring :as ring]))

(defn list-users [_] {:status 200})
(defn create-user [_] {:status 201})
(defn show-user [_] {:status 200})

(def app
  (ring/ring-handler
    (ring/router
      [["/api/users" {:get list-users :post create-user}]
       ["/api/users/:id" {:get show-user}]])))
