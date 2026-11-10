(ns app.main
  (:require [app.routes :as r]
            [compojure.core :refer [routes]]
            [compojure.route :as route]
            [ring.middleware.params :as params]))

(defn wrap-auth [h] (fn [q] (h q)))

(def app
  (-> (routes r/api (route/not-found "nf"))
      wrap-auth
      params/wrap-params))
