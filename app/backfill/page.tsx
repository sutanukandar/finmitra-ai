"use client";

import { useState } from 'react';

export default function BackfillWizard() {
  const [restaurantId, setRestaurantId] = useState(""); // You can make this dynamic later
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Add a new day row
  const addDay = () => {
    setEntries([...entries, {
      date: "",
      swiggy: 0,
      phonepe: 0,
      hyperpure: 0,
      bigbasket: 0,
      milk: 0,
      bread: 0,
      rent: 0,
      electricity: 0,
      gas: 0,
      salary: 0,
      fixed: 0,
      items: []
    }]);
  };

  // Update aggregated field
  const updateField = (index: number, field: string, value: any) => {
    const newEntries = [...entries];
    newEntries[index][field] = value;
    setEntries(newEntries);
  };

  // Submit backfill
  const handleSubmit = async () => {
    if (!restaurantId) {
      setMessage("Please enter Restaurant ID");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch('/api/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          entries: entries
        })
      });

      const result = await res.json();

      if (result.success) {
        setMessage(`✅ Successfully backfilled ${result.results.length} days!`);
        // Optionally clear form
      } else {
        setMessage(`❌ Error: ${result.error}`);
      }
    } catch (err) {
      setMessage("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Backfill Wizard</h1>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Restaurant ID</label>
        <input
          type="text"
          value={restaurantId}
          onChange={(e) => setRestaurantId(e.target.value)}
          className="border p-3 w-full rounded-lg"
          placeholder="Enter restaurant UUID"
        />
      </div>

      <button
        onClick={addDay}
        className="bg-blue-600 text-white px-6 py-3 rounded-lg mb-6"
      >
        + Add New Day
      </button>

      <div className="space-y-8">
        {entries.map((entry, index) => (
          <div key={index} className="border p-6 rounded-xl bg-gray-50">
            <input
              type="date"
              value={entry.date}
              onChange={(e) => updateField(index, 'date', e.target.value)}
              className="border p-3 rounded-lg mb-4"
            />

            {/* Aggregated Totals */}
            <div className="grid grid-cols-6 gap-4 mb-6">
              <input type="number" placeholder="Swiggy" value={entry.swiggy} onChange={(e) => updateField(index, 'swiggy', Number(e.target.value))} className="border p-3 rounded-lg" />
              <input type="number" placeholder="PhonePe" value={entry.phonepe} onChange={(e) => updateField(index, 'phonepe', Number(e.target.value))} className="border p-3 rounded-lg" />
              <input type="number" placeholder="Hyperpure" value={entry.hyperpure} onChange={(e) => updateField(index, 'hyperpure', Number(e.target.value))} className="border p-3 rounded-lg" />
              <input type="number" placeholder="Bigbasket" value={entry.bigbasket} onChange={(e) => updateField(index, 'bigbasket', Number(e.target.value))} className="border p-3 rounded-lg" />
              <input type="number" placeholder="Milk" value={entry.milk} onChange={(e) => updateField(index, 'milk', Number(e.target.value))} className="border p-3 rounded-lg" />
              <input type="number" placeholder="Bread" value={entry.bread} onChange={(e) => updateField(index, 'bread', Number(e.target.value))} className="border p-3 rounded-lg" />
            </div>

            {/* Item Level - Future enhancement */}
            <p className="text-sm text-gray-500">Item-level data support coming soon in this UI.</p>
          </div>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-8 bg-green-600 text-white px-8 py-4 rounded-xl text-lg font-semibold disabled:bg-gray-400"
      >
        {loading ? "Saving..." : "Save All Data"}
      </button>

      {message && (
        <div className="mt-6 p-4 bg-gray-100 rounded-lg">
          {message}
        </div>
      )}
    </div>
  );
}
