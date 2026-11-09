(ns cart.core)

(def item-types
  [{:type :book :price 10 :path [:catalog :books]}
   {:type :music :price 5 :path [:catalog :music]}
   {:type :film :path [:catalog :films]}])

(defn line-total [{:keys [price qty] :or {qty 1} :as item}]
  (* price qty (get item :discount 1)))

(defn configure [opts & {:keys [verbose]}] (assoc opts :verbose verbose))

(defn checkout [cart]
  (let [{:keys [items]} cart]
    (-> cart
        (assoc :total (reduce + (map line-total items)))
        (dissoc :draft)
        (update :count inc))))

(defn summary [cart]
  {:total (:total cart)
   :count (get-in cart [:meta :count])
   :first (line-total {:price 1 :qty 2 :coupon "x"})
   :cfg (configure {} :verbose true)
   :depth (-> cart :meta :depth)
   :h (hash-map :x 1)})
