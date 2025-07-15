import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, 
  PolarRadiusAxis, Radar 
} from 'recharts';
import { 
  User, Activity, Clock, Target, TrendingUp, Award, 
  BookOpen, Calendar, CheckCircle, Circle, ArrowLeft 
} from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import apiService from '../services/apiService';
import type { Dashboard as DashboardData, SessionStats, ParentActivity } from '../services/apiService'
import '../styles/Dashboard.css';

const Dashboard: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useUser();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions'>('overview');
  const [selectedSession, setSelectedSession] = useState<SessionStats | null>(null);
  const [completedActivities, setCompletedActivities] = useState<Set<string>>(new Set());

  const currentUserId = userId || user?.id;

  useEffect(() => {
    const fetchDashboard = async () => {
      if (!currentUserId || !isAuthenticated) {
        setError('Please log in to view dashboard');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const data = await apiService.getDashboard(currentUserId);
        setDashboardData(data);
        
        // Set the first session as selected by default
        if (data.session_stats.length > 0) {
          setSelectedSession(data.session_stats[0]);
        }
      } catch (err) {
        setError('Failed to load dashboard data');
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [currentUserId, isAuthenticated]);

  const handleActivityComplete = (activityName: string) => {
    setCompletedActivities(prev => new Set([...prev, activityName]));
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !dashboardData) {
    return (
      <div className="dashboard-container">
        <div className="error-message">
          <h2>Dashboard Unavailable</h2>
          <p>{error || 'No dashboard data available'}</p>
          <button onClick={() => navigate('/')} className="back-button">
            <ArrowLeft size={16} />
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Prepare chart data
  const sessionHistoryData = dashboardData.session_stats.map(session => ({
    date: formatDate(session.date),
    mastery: Math.round(session.mastery_score * 100),
    completion: Math.round(session.completion * 100),
    sessionTime: session.session_time,
    engagement: session.engagement_score ? Math.round(session.engagement_score * 100) : 0,
  }));

  const skillStatsData = dashboardData.user_stats.skill_stats_aggregate ? [
    { skill: 'Mastery', score: Math.round(dashboardData.user_stats.skill_stats_aggregate.mastery_score * 100) },
    { skill: 'Critical Thinking', score: Math.round((dashboardData.user_stats.skill_stats_aggregate.critical_thinking_score || 0) * 100) },
    { skill: 'Problem Solving', score: Math.round((dashboardData.user_stats.skill_stats_aggregate.problem_solving_score || 0) * 100) },
    { skill: 'Creativity', score: Math.round((dashboardData.user_stats.skill_stats_aggregate.creativity_score || 0) * 100) },
    { skill: 'Communication', score: Math.round((dashboardData.user_stats.skill_stats_aggregate.communication_score || 0) * 100) },
    { skill: 'Social Skills', score: Math.round((dashboardData.user_stats.skill_stats_aggregate.social_skills_score || 0) * 100) },
  ] : [];

  const topicWiseData = selectedSession?.topic_wise_mastery ? 
    Object.entries(selectedSession.topic_wise_mastery).map(([topic, score]) => ({
      topic,
      score: Math.round(score * 100)
    })) : [];

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <button onClick={() => navigate('/')} className="back-button">
          <ArrowLeft size={20} />
          Back to Home
        </button>
        <h1>Learning Dashboard</h1>
        <div className="user-badge">
          <User size={20} />
          <span>{user?.name || 'User'}</span>
        </div>
      </header>

      <div className="dashboard-tabs">
        <button 
          className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <TrendingUp size={18} />
          Overview & Stats
        </button>
        <button 
          className={`tab-button ${activeTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setActiveTab('sessions')}
        >
          <Calendar size={18} />
          Session Analysis
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="overview-tab">
          {/* User Stats Cards */}
          <div className="stats-grid">
            <div className="stat-card streak">
              <div className="stat-icon">🔥</div>
              <div className="stat-content">
                <h3>{dashboardData.user_stats.streak}</h3>
                <p>Day Streak</p>
              </div>
            </div>
            
            <div className="stat-card time">
              <div className="stat-icon">
                <Clock size={24} />
              </div>
              <div className="stat-content">
                <h3>{formatTime(dashboardData.user_stats.total_learning_time)}</h3>
                <p>Total Learning Time</p>
              </div>
            </div>
            
            <div className="stat-card completion">
              <div className="stat-icon">
                <Target size={24} />
              </div>
              <div className="stat-content">
                <h3>{Math.round(dashboardData.user_stats.overall_completion_rate * 100)}%</h3>
                <p>Completion Rate</p>
              </div>
            </div>
            
            <div className="stat-card lessons">
              <div className="stat-icon">
                <BookOpen size={24} />
              </div>
              <div className="stat-content">
                <h3>{dashboardData.user_stats.total_lessons_started}</h3>
                <p>Lessons Started</p>
              </div>
            </div>
          </div>

          {/* Skills Radar Chart */}
          {skillStatsData.length > 0 && (
            <div className="chart-section">
              <h2>Skills Assessment</h2>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={400}>
                  <RadarChart data={skillStatsData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="skill" />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} />
                    <Radar 
                      name="Skills" 
                      dataKey="score" 
                      stroke="#8884d8" 
                      fill="#8884d8" 
                      fillOpacity={0.3}
                    />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Session History Chart */}
          <div className="chart-section">
            <h2>Learning Progress</h2>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={sessionHistoryData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="mastery" fill="#8884d8" name="Mastery %" />
                  <Bar dataKey="completion" fill="#82ca9d" name="Completion %" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Parent Activities */}
          <div className="activities-section">
            <h2>Recommended Activities for Parents</h2>
            <div className="completion-rate">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${dashboardData.parent_stats.recommendation_completion * 100}%` }}
                ></div>
              </div>
              <span>{Math.round(dashboardData.parent_stats.recommendation_completion * 100)}% Completed</span>
            </div>
            
            <div className="activities-grid">
              {dashboardData.parent_stats.recommended_activities.map((activity, index) => {
                const isCompleted = activity.activity_status === 'completed' || 
                                  completedActivities.has(activity.activity_name);
                
                return (
                  <div key={index} className={`activity-card ${isCompleted ? 'completed' : ''}`}>
                    <div className="activity-header">
                      <h3>{activity.activity_name}</h3>
                      <button 
                        className={`complete-button ${isCompleted ? 'completed' : ''}`}
                        onClick={() => handleActivityComplete(activity.activity_name)}
                        disabled={isCompleted}
                      >
                        {isCompleted ? <CheckCircle size={20} /> : <Circle size={20} />}
                      </button>
                    </div>
                    
                    <p className="activity-description">{activity.activity_description}</p>
                    
                    <div className="activity-meta">
                      <span className="activity-type">{activity.activity_type}</span>
                      <span className="activity-duration">{formatTime(activity.activity_duration)}</span>
                    </div>
                    
                    <div className="objectives">
                      <h4>Objectives:</h4>
                      <ul>
                        {activity.objectives.map((objective, objIndex) => (
                          <li key={objIndex}>{objective}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Learning Insights */}
          {dashboardData.user_stats.learning_insights && (
            <div className="insights-section">
              <h2>Learning Insights</h2>
              <div className="insights-card">
                <div className="insights-icon">
                  <Award size={24} />
                </div>
                <p>{dashboardData.user_stats.learning_insights}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="sessions-tab">
          <div className="sessions-layout">
            <div className="sessions-list">
              <h2>Learning Sessions</h2>
              {dashboardData.session_stats.map((session, index) => (
                <div 
                  key={session.session_id}
                  className={`session-item ${selectedSession?.session_id === session.session_id ? 'selected' : ''}`}
                  onClick={() => setSelectedSession(session)}
                >
                  <div className="session-date">{formatDate(session.date)}</div>
                  <div className="session-stats">
                    <span className="mastery">Mastery: {Math.round(session.mastery_score * 100)}%</span>
                    <span className="time">{formatTime(session.session_time)}</span>
                  </div>
                </div>
              ))}
            </div>

            {selectedSession && (
              <div className="session-details">
                <h2>Session Details</h2>
                <div className="session-header">
                  <h3>{formatDate(selectedSession.date)}</h3>
                  <span className="session-id">Session: {selectedSession.session_id}</span>
                </div>

                <div className="session-metrics">
                  <div className="metric">
                    <h4>Mastery Score</h4>
                    <div className="metric-value">{Math.round(selectedSession.mastery_score * 100)}%</div>
                  </div>
                  <div className="metric">
                    <h4>Completion</h4>
                    <div className="metric-value">{Math.round(selectedSession.completion * 100)}%</div>
                  </div>
                  <div className="metric">
                    <h4>Session Time</h4>
                    <div className="metric-value">{formatTime(selectedSession.session_time)}</div>
                  </div>
                  {selectedSession.engagement_score && (
                    <div className="metric">
                      <h4>Engagement</h4>
                      <div className="metric-value">{Math.round(selectedSession.engagement_score * 100)}%</div>
                    </div>
                  )}
                </div>

                {selectedSession.questions_answered && (
                  <div className="qa-stats">
                    <div className="qa-metric">
                      <span>Questions Answered: {selectedSession.questions_answered}</span>
                    </div>
                    {selectedSession.questions_asked && (
                      <div className="qa-metric">
                        <span>Questions Asked: {selectedSession.questions_asked}</span>
                      </div>
                    )}
                  </div>
                )}

                {topicWiseData.length > 0 && (
                  <div className="topic-mastery">
                    <h3>Topic-wise Mastery</h3>
                    <div className="radar-container">
                      <ResponsiveContainer width="100%" height={300}>
                        <RadarChart data={topicWiseData}>
                          <PolarGrid />
                          <PolarAngleAxis dataKey="topic" />
                          <PolarRadiusAxis angle={90} domain={[0, 100]} />
                          <Radar 
                            name="Mastery" 
                            dataKey="score" 
                            stroke="#ff7300" 
                            fill="#ff7300" 
                            fillOpacity={0.3}
                          />
                          <Tooltip />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard; 