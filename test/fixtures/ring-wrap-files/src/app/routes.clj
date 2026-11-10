(ns app.routes
  (:require [compojure.core :refer [defroutes GET POST]]))

(defn users [r] {:status 200})

(defn delete-all [r] {:status 200})

(defroutes api
  (GET "/users" [] users)
  (POST "/danger" [] delete-all))
