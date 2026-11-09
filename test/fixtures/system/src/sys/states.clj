(ns sys.states
  (:require [mount.core :refer [defstate]]))

(defn connect [] 1)

(defstate conn :start (connect))

(defstate cache :start {:conn conn})
