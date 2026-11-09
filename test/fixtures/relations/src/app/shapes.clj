(ns app.shapes)

(defmulti area :kind)
(defmethod area ::circle [_] 1)
(defmethod area ::shape [_] 0)
(derive ::square ::shape)
(prefer-method area ::circle ::shape)

(defprotocol Named (label [x]))
(defrecord Box [n])
(extend-type Box Named (label [b] (str (:n b))))
(extend-protocol Named String (label [s] s))
(defn anon [] (reify Named (label [_] "anon")))

(defn describe [x] (str (label x) (area x)))
