(ns app.local
  (:refer-clojure :exclude [binding])
  (:require [app.core :as core]))

(defn binding [v f] (f v))

(defn shadowed [] (binding [core/log! 1] (core/audit 1)))

(defn iterates [] (for [f core/handlers] f))

(defn real-rebind [] (clojure.core/binding [core/*sink* []] (core/audit 1)))
