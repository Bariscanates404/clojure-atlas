(ns app.core
  (:require [app.handlers :as h]
            [app.middleware :as m]
            [compojure.core :refer [defroutes routes wrap-routes GET POST]]
            [ring.adapter.jetty :as jetty]
            [ring.middleware.json :as json]
            [ring.middleware.params :as params]))

(defroutes threaded-routes
  (GET "/index" [] h/index))

(defroutes private-routes
  (POST "/secret" [] h/secret))

(defroutes nested-routes
  (GET "/nested" [] h/nested))

(defroutes route-level
  (GET "/routed" [] h/routed))

(defroutes dynamic-routes
  (GET "/dyn" [] h/dyn))

(defn fn-routes []
  (routes (GET "/fn" [] h/index)))

(defroutes loose-routes
  (GET "/loose" [] h/loose))

(def threaded
  (-> threaded-routes
      (json/wrap-json-body {:keywords? true})
      params/wrap-params))

(def nested-app
  (m/with-log (m/wrap-auth nested-routes)))

(def combined
  (routes
   (-> private-routes
       (wrap-routes m/wrap-auth))
   (wrap-routes route-level m/with-log)))

(def app
  (-> (routes threaded nested-app combined)
      (json/wrap-json-response)))

(defn make-handlers [rs] (apply routes rs))

(def assembled (make-handlers [dynamic-routes]))

(def guessed (m/plain-helper loose-routes))

(def fn-app (m/wrap-auth (fn-routes)))

(defn -main [] (jetty/run-jetty fn-app {:port 3000}))

(def inline (m/with-log (GET "/inline" [] h/index)))

(def commented (m/with-log (GET "/commented" [] h/index)))

(comment (commented {}))

(def served (m/with-log (GET "/served" [] h/index)))

(defn probe [] (served {}))
