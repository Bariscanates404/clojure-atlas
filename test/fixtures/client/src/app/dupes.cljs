(ns app.dupes
  (:require [reitit.frontend :as rfe]))

(def dupes
  [["/a/:id" {:name ::a}]
   ["/a/:slug" {:name ::a2}]])

(def dupes-router (rfe/router dupes))
