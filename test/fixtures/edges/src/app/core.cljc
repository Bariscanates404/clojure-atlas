(ns app.core
  (:require [app.compat :as-alias c :refer [shim]]
            [app.specs :as-alias specs]
            [app.util :as u]
            [clojure.string :as str]))

(declare helper)

(defn run [xs] (map helper xs))

(defn helper
  ([y] (inc y))
  ([y z] (+ y z (u/id (shim y)))))

(defn twice [a] (+ (helper 1) (helper 2 3)))

(defn pick [t] (if t helper nil))
(defn hold [] (do helper))
(defn safe [] (try helper (catch #?(:clj Exception :cljs :default) _ helper)))
(defn both [xs] (map #?(:clj helper :cljs helper) xs))

(defn countdown [n] (if (pos? n) (countdown (dec n)) 0))
