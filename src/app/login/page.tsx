//LOGIN

import React, { useState } from 'react';
import { User, Lock, Loader2 } from 'lucide-react';

export default function BakersTheoryLogin() {
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate authentication delay
    setTimeout(() => setIsLoading(false), 2000); 
  };

  return (
    // Background: Deep Chocolate textured base
    <div className="min-h-screen flex items-center justify-center bg-[#2B180D] relative overflow-hidden font-sans">
      
      {/* Abstract Background Line-Art / Depth simulation */}
      <div className="absolute top-[-15%] right-[-10%] w-[500px] h-[500px] border-[1px] border-[#D4AF37]/10 rounded-[40%] opacity-40 rotate-45 pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-15%] w-full h-96 border-t-[1px] border-[#D4AF37]/10 opacity-30 rotate-12 pointer-events-none"></div>

      {/* Main Login Card: Ceramic Cream Neumorphism */}
      <div className="relative z-10 w-full max-w-[360px] px-8 py-10 bg-[#F2ECE4] rounded-3xl shadow-[0_40px_80px_rgba(0,0,0,0.6),inset_0_2px_4px_rgba(255,255,255,1)] border border-white/60">

        {/* Logo & Branding Section */}
        <div className="flex flex-col items-center mb-10">
          
          {/* 3D Gold Monogram (BT) */}
          <div className="relative mb-3 flex items-center justify-center">
            {/* Base shadow layer */}
            <span className="absolute text-7xl font-serif font-black text-black/40 blur-[4px] translate-y-2 translate-x-1">
              BT
            </span>
            {/* Metallic gold gradient layer */}
            <span className="relative text-7xl font-serif font-black text-transparent bg-clip-text bg-gradient-to-br from-[#FFF5C3] via-[#D4AF37] to-[#8C6314] drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
              BT
            </span>
          </div>

          {/* Wordmark */}
          <h1 className="text-[26px] font-black tracking-tighter text-[#4A2E1B] drop-shadow-[0_1px_1px_rgba(255,255,255,1)]">
            bakers theory
          </h1>

          {/* Established Date */}
          <div className="flex items-center gap-3 mt-1">
            <div className="h-px w-10 bg-[#8B7355]/40"></div>
            <span className="text-[10px] font-bold tracking-[0.25em] text-[#8B7355] drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]">
              EST. 2026
            </span>
            <div className="h-px w-10 bg-[#8B7355]/40"></div>
          </div>
        </div>

        {/* Form Fields */}
        <form onSubmit={handleLogin} className="space-y-5">

          {/* User ID Field */}
          <div className="space-y-1.5">
            <label className="block text-sm font-bold text-[#4A2E1B] ml-1 font-serif drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
              User ID
            </label>
            {/* Recessed channel styling (Inset Shadows) */}
            <div className="relative flex items-center bg-[#E6DDD1] rounded-2xl shadow-[inset_0_4px_8px_rgba(0,0,0,0.15),0_1px_2px_rgba(255,255,255,1)] overflow-hidden transition-all focus-within:ring-2 focus-within:ring-[#D4AF37]/40">
              <input
                type="text"
                placeholder="Enter your ID"
                className="w-full bg-transparent py-3.5 pl-5 pr-12 text-[#4A2E1B] placeholder-[#A38D7A] outline-none font-medium text-sm"
                required
              />
              <User className="absolute right-4 w-5 h-5 text-[#9C8471] drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]" strokeWidth={2.5} />
            </div>
          </div>

          {/* Password Field */}
          <div className="space-y-1.5">
            <label className="block text-sm font-bold text-[#4A2E1B] ml-1 font-serif drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
              Password
            </label>
            {/* Recessed channel styling */}
            <div className="relative flex items-center bg-[#E6DDD1] rounded-2xl shadow-[inset_0_4px_8px_rgba(0,0,0,0.15),0_1px_2px_rgba(255,255,255,1)] overflow-hidden transition-all focus-within:ring-2 focus-within:ring-[#D4AF37]/40">
              <input
                type="password"
                placeholder="••••••••"
                className="w-full bg-transparent py-3.5 pl-5 pr-12 text-[#4A2E1B] placeholder-[#A38D7A] outline-none tracking-[0.2em] font-medium text-sm"
                required
              />
              <Lock className="absolute right-4 w-5 h-5 text-[#9C8471] drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]" strokeWidth={2.5} />
            </div>
          </div>

          {/* Loading Indicator & Button Area */}
          <div className="pt-4">
            
            {/* Subtle Loading Spinner */}
            <div className="flex justify-end items-center mb-2 h-4 pr-1">
              <div className={`flex items-center text-[#4A2E1B] text-xs font-semibold space-x-1.5 transition-opacity duration-300 ${isLoading ? 'opacity-100' : 'opacity-0'}`}>
                <span>Sign in</span>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8C6314]" />
              </div>
            </div>

            {/* Tactile 3D Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full relative group outline-none"
            >
              {/* Bottom Shadow / Physical edge of the button */}
              <div className="absolute inset-0 bg-[#1A0D07] rounded-xl translate-y-1.5 group-active:translate-y-0.5 transition-transform duration-100 ease-in-out"></div>
              
              {/* Top Face of the button */}
              <div className="relative flex items-center justify-center w-full py-3.5 bg-gradient-to-b from-[#55331E] to-[#3B2313] border border-[#D4AF37]/40 rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] group-active:translate-y-1 transition-transform duration-100 ease-in-out">
                <span className="font-bold text-[#F3E5AB] text-lg tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  Login
                </span>
              </div>
            </button>
            
          </div>
        </form>
      </div>
    </div>
  );
}
