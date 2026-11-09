(ns shapes.util
  (:require [shapes.core :as core]))

(defn square [x] (* x x))

(defmethod core/area ::square [{:keys [side]}] (square side))
