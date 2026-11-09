(ns app.profiles
  (:require [ajax.core :as ajax]))

(defn user-url [id] (str "/users/" id "/profile"))

(defn load-profile! [id]
  (ajax/GET (user-url id) {:handler identity}))

(defn load-fixed-profile! []
  (ajax/GET (user-url "5") {:handler identity}))

(defn load-with-query! []
  (ajax/GET "/users/list?full=1"))

(defn home-url [] (str "/users/" "me"))

(defn load-home! []
  (ajax/GET (home-url)))
