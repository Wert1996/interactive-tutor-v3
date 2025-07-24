import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import CourseGrid from './components/CourseGrid';
import CourseDetail from './components/CourseDetail';
import LearningScreen from './components/LearningScreen';
import Dashboard from './components/Dashboard';
import CharacterSelection from './components/CharacterSelection';
import './App.css';

function App() {
  return (
    <UserProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<CourseGrid />} />
            <Route path="/course/:courseId" element={<CourseDetail />} />
            <Route path="/course/:courseId/character-selection" element={<CharacterSelection />} />
            <Route path="/course/:courseId/learn" element={<LearningScreen />} />
            <Route path="/dashboard/:userId?" element={<Dashboard />} />
          </Routes>
        </div>
      </Router>
    </UserProvider>
  );
}

export default App;
