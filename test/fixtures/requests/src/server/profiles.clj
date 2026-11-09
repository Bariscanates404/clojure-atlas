(ns server.profiles
  (:require [reitit.ring :as ring]))

(defn show [_req] {:status 200})
(defn profile [_req] {:status 200})

(def router
  (ring/router [["/users/list" {:get {:handler show}}]
                ["/users/:id" {:get {:handler show}}]
                ["/users/:id/profile" {:get {:handler profile}}]]))
