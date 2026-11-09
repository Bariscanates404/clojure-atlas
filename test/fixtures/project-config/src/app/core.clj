(ns app.core
  (:require [app.macros :refer [defthing deftrecord]]))

(defthing widget 1)

(deftrecord Variable [symbol])

(defrecord Box [n])

(defn make [x]
  [widget
   (->Variable x) (map->Variable {:symbol x}) (Variable. x) (instance? Variable x)
   (->Box x) (map->Box {:n x}) (Box. x) (instance? Box x)])

(defn broken [] (app.macros/never-defined 1))
