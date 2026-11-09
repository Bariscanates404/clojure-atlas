(ns app.core)

(defn save! [db x] (assoc db :x x))
(defn log! [x] x)
(defn audit [x] x)

(def handlers [save! log!])

(def saver (partial save! {}))

(def pipeline (comp log! audit))

(defn run-all [xs] (apply save! xs))

(defn aliased [x]
  (let [f log!]
    (f x)))

(defn make-logger [] (fn [x] (log! x)))

(defn returns-fn [] audit)

(defn never-runs [] (map save! []))

(defn threaded [x] (-> x log! audit))

(defmacro with-log [& body] `(do (log! :start) ~@body))

(defn wrapped [] (with-log (audit 1)))

(def ^:dynamic *sink* nil)

(defn test-double [] (with-redefs [save! (fn [_ _] nil)] (binding [*sink* []] (save! {} 1))))

(defn on-change [_ _ _ _] nil)
(def state (atom nil))
(add-watch state ::watch on-change)

(defn only-in-rich-comment [x] x)

(comment
  (only-in-rich-comment 1)
  (save! {} 2)
  (defn scratch [x] (audit x)))
