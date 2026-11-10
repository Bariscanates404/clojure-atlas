(ns app.table
  (:require [app.views :as views]))

(def table
  [["/inbox"
    {:name :inbox
     :view views/inbox}]
   ["/inbox/:id"
    {:name :message
     :view views/message}]])

(def unnamed
  [["/loose" {:view views/inbox}]
   ["/other" {:name :other}]])

(def hiccup
  [:div ["/not-a-route" {:name "label"}]])

(def mixed
  [["/mixed" {:name :mixed}]
   [:span "text"]])

(def conditional
  [["/shown" {:name :shown}]
   (when config/dev?
     ["/dev-only" {:name :dev-only}])])
