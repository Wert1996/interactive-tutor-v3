import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import CourseGrid from './components/CourseGrid';
import CourseDetail from './components/CourseDetail';
import LearningScreen from './components/LearningScreen';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<CourseGrid />} />
          <Route path="/course/:courseId" element={<CourseDetail />} />
          <Route path="/course/:courseId/learn" element={<LearningScreen />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
