(ns web.pedestal-app
  (:require [io.pedestal.http.route :as route]
            [web.handlers :as h]))

(def common-interceptors [h/audit])

(def table
  (route/expand-routes
    #{["/items" :get [h/audit h/list-items] :route-name :items]
      ["/health" :get h/health :route-name :health]
      ["/admin" :get (conj common-interceptors `h/list-items) :route-name :admin]}))
