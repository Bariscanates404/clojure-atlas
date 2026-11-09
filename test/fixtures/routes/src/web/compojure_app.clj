(ns web.compojure-app
  (:require [compojure.core :refer [defroutes GET POST context]]
            [web.handlers :as h]))

(defroutes app
  (GET "/health" [] (h/health))
  (GET "/report" [] (let [x (h/upload nil)] (h/show-user x)))
  (context "/api" []
    (context "/users/:id" [id]
      (GET "/" [] (h/show-user id))
      (POST "/avatar" req (h/upload req)))))
