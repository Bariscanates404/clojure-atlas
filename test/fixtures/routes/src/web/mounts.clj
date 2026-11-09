(ns web.mounts
  (:require [compojure.core :refer [defroutes context GET routes]]
            [web.more-handlers :as h]))

(defroutes user-routes
  (GET "/" [] (h/root nil))
  (GET "/me" [] h/show))

(defroutes pages
  (GET "/p" [] (h/layout (h/page nil)))
  (GET "/q" [] (if true (h/a nil) (h/b nil)))
  (GET "/r" [] (let [x 1] (h/other x))))

(defroutes app
  (context "/users" [] user-routes)
  (context (str "/dyn") [] (GET "/z" [] h/show))
  pages)

(defroutes outer
  (context "/v1" [] (routes (context "/api" [] app))))
