(ns model.malli
  (:require [malli.core :as m]))

(def Address [:map [:street :string]])

(def User [:map [:id :int] [:address Address]])

(def not-a-schema [:div "x"])

(defn valid-user? [u] (m/validate User u))

(defn address-of [u] (get u :address Address))
