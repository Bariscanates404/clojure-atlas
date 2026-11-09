(ns app.routes
  (:require [reitit.frontend :as rfe]
            [secretary.core :refer-macros [defroute]]))

(defn home-page [] [:div])
(defn doc-page [] [:div])

(def routes
  [["/" {:name ::home :view home-page}]
   ["/doc/:locale/*slug" {:name ::doc :view doc-page}]
   ["/admin" {:conflicting true}
    ["/users/:id" {:name ::user}]
    ["/plain" {:other 1}]]])

(def router (rfe/router routes))

#_{:clj-kondo/ignore [:unresolved-symbol]} (defroute "/legacy/:id" [id] (js/console.log id))
