(ns shapes.core
  (:require [shapes.util :as u]))

(defmulti area :kind)

(defmethod area ::circle [{:keys [r]}] (u/square r))

(defmethod area :default [_] 0)

(defmethod print-method ::circle [x w] (.write w (str x)))

(defn total [shapes] (reduce + (map area shapes)))

(defmethod area ::poly [_] (reify Object (toString [_] (str (u/square 2)))))
