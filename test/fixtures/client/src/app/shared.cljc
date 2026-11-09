(ns app.shared
  (:require [reitit.core :as r]))

(def shared-routes
  [["/items/:id" {:name ::item :view :item-view}]
   ["/items/:slug/edit" {:name ::edit}]])

(def shared-router (r/router shared-routes))
