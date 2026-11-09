(ns web.pedestal-app
  (:require [io.pedestal.http.route :as route]
            [web.handlers :as h]))

(def table
  (route/expand-routes
    #{["/items" :get [h/audit h/list-items] :route-name :items]
      ["/health" :get h/health :route-name :health]}))
