'use client';

import { useState } from 'react';

export default function BackfillWizard() {
  const [step, setStep] = useState(1);
  const [restaurant, setRestaurant] = useState({
    name: '',
    owner_name: '',
    city: '',
    mobile: ''
  });

  // Last 60 days daily data
  const [dailyData, setDailyData] = useState<Record<string, any>>({});

  const today = new Date();
  const days = Array.from({ length: 60 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    return date.toISOString().split('T')[0];
  });

  const updateDailyData = (date: string, field: string, value: number) => {
    setDailyData(prev => ({
      ...prev,
      [date]: {
        ...prev[date],
        [field]: value
      }
    }));
  };

  const handleActivate = async () => {
    const payload = {
      restaurant,
      dailyData,
      source: "manual_backfill"
    };

    alert(`✅ Backfill data prepared for ${restaurant.name}!\n\n${Object.keys(dailyData).length} days of data ready to save.\n\n(In next version this will call the backend API)`);
    console.log("Backfill Payload:", payload);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-2xl p-10">
        <h1 className="text-4xl font-bold text-center mb-2">FinMitra — Founder Backfill Wizard</h1>
        <p className="text-center text-gray-600 mb-10">Step-by-step onboarding with daily data entry</p>

        {step === 1 && (
          <div>
            <h2 className="text-2xl mb-6">Step 1: Restaurant Details</h2>
            <div className="grid grid-cols-2 gap-6">
              <input type="text" placeholder="Restaurant Name *" className="p-4 border rounded-xl" 
                onChange={(e) => setRestaurant({...restaurant, name: e.target.value})} />
              <input type="text" placeholder="Owner Name" className="p-4 border rounded-xl" 
                onChange={(e) => setRestaurant({...restaurant, owner_name: e.target.value})} />
              <input type="text" placeholder="City" className="p-4 border rounded-xl" 
                onChange={(e) => setRestaurant({...restaurant, city: e.target.value})} />
              <input type="text" placeholder="Mobile (+91...)" className="p-4 border rounded-xl" 
                onChange={(e) => setRestaurant({...restaurant, mobile: e.target.value})} />
            </div>
            <button onClick={() => setStep(2)} className="mt-8 bg-blue-600 text-white px-12 py-4 rounded-xl text-lg w-full">
              Next → Enter Daily Data
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-2xl mb-6">Step 2: Enter Daily Data (Last 60 Days)</h2>
            <p className="text-red-600 mb-6">Fill whatever data you have. Leave blank for days with no data.</p>

            <div className="max-h-[600px] overflow-auto border rounded-xl p-4 bg-gray-50">
              {days.map(date => (
                <div key={date} className="grid grid-cols-7 gap-3 mb-6 p-4 bg-white rounded-lg border">
                  <div className="col-span-7 font-medium text-gray-700">{new Date(date).toLocaleDateString('en-IN', {weekday:'short', day:'numeric', month:'short'})}</div>
                  
                  <input type="number" placeholder="Swiggy" className="p-3 border rounded" 
                    onChange={(e) => updateDailyData(date, 'swiggy', Number(e.target.value))} />
                  <input type="number" placeholder="PhonePe" className="p-3 border rounded" 
                    onChange={(e) => updateDailyData(date, 'phonepe', Number(e.target.value))} />
                  <input type="number" placeholder="Hyperpure" className="p-3 border rounded" 
                    onChange={(e) => updateDailyData(date, 'hyperpure', Number(e.target.value))} />
                  <input type="number" placeholder="BigBasket" className="p-3 border rounded" 
                    onChange={(e) => updateDailyData(date, 'bigbasket', Number(e.target.value))} />
                  <input type="number" placeholder="Milk+Bread" className="p-3 border rounded" 
                    onChange={(e) => updateDailyData(date, 'milk', Number(e.target.value))} />
                  <input type="number" placeholder="Fixed (Rent etc)" className="p-3 border rounded" 
                    onChange={(e) => updateDailyData(date, 'fixed', Number(e.target.value))} />
                </div>
              ))}
            </div>

            <button onClick={handleActivate} className="mt-8 bg-green-600 hover:bg-green-700 text-white px-12 py-5 rounded-2xl text-xl w-full font-semibold">
              Activate Restaurant & Save All Daily Data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
