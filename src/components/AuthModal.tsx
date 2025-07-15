import React, { useState } from 'react';
import { useUser } from '../contexts/UserContext';
import apiService from '../services/apiService';
import OnboardingFlow from './OnboardingFlow';
import '../styles/AuthModal.css';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [userName, setUserName] = useState('');
  const [userId, setUserId] = useState('');
  const [signUpUserId, setSignUpUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { login } = useUser();

  if (!isOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const user = await apiService.getUser(userId);
      login(user);
      onClose();
    } catch (err) {
      setError('User not found. Please check your user ID or sign up.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !signUpUserId.trim()) return;

    setShowOnboarding(true);
  };

  const handleOnboardingComplete = async (onboardingData: any) => {
    setLoading(true);
    setError(null);

    try {
      const user = await apiService.createUser({
        id: signUpUserId,
        name: userName,
        onboarding_data: onboardingData,
      });
      login(user);
      onClose();
    } catch (err) {
      setError('Failed to create user. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setShowOnboarding(false);
    setError(null);
    setUserName('');
    setUserId('');
    setSignUpUserId('');
    onClose();
  };

  if (showOnboarding) {
    return (
      <OnboardingFlow
        onComplete={handleOnboardingComplete}
        onBack={() => setShowOnboarding(false)}
        userName={userName}
        loading={loading}
        error={error}
      />
    );
  }

  return (
    <div className="auth-modal-overlay" onClick={handleClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-header">
          <h2>{isSignUp ? 'Sign Up' : 'Sign In'}</h2>
          <button className="close-button" onClick={handleClose}>×</button>
        </div>

        <div className="auth-modal-body">
          {error && <div className="error-message">{error}</div>}

          <form onSubmit={isSignUp ? handleSignUp : handleSignIn}>
            {isSignUp ? (
              <>
                <div className="form-group">
                  <label htmlFor="signUpUserId">User ID</label>
                  <input
                    id="signUpUserId"
                    type="text"
                    value={signUpUserId}
                    onChange={(e) => setSignUpUserId(e.target.value)}
                    placeholder="Choose a unique user ID"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="userName">Your Name</label>
                  <input
                    id="userName"
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Enter your name"
                    required
                  />
                </div>
              </>
            ) : (
              <div className="form-group">
                <label htmlFor="userId">User ID</label>
                <input
                  id="userId"
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="Enter your user ID"
                  required
                />
              </div>
            )}

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Loading...' : isSignUp ? 'Continue' : 'Sign In'}
            </button>
          </form>

          <div className="auth-switch">
            <p>
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}
              <button 
                type="button"
                className="switch-button"
                onClick={() => setIsSignUp(!isSignUp)}
              >
                {isSignUp ? 'Sign In' : 'Sign Up'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal; 