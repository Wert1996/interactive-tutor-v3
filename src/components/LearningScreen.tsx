import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import '../styles/LearningScreen.css';

interface SessionData {
  id: string;
  user_id: string;
  course_id: string;
  created_at: string;
  status: string;
  progress: {
    topic_id: string;
    module_id: string;
    phase_id: number;
  };
}

const LearningScreen: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);

  // Message handler for WebSocket messages
  const handleWebSocketMessage = (messages: any[]) => {
    messages.forEach((message, index) => {
      console.log(`Processing message ${index}:`, message);
      
      switch (message.type) {
        case 'pong':
          console.log('Ping successful, marking as connected');
          setConnectionStatus('connected');
          
          // Start session after successful connection using existing session ID
          if (sessionData?.id) {
            const startSessionMessage = {
              type: "start_session",
              session_id: sessionData.id
            };
            
            console.log('Sending start_session message:', startSessionMessage);
            if (websocketRef.current) {
              websocketRef.current.send(JSON.stringify(startSessionMessage));
            }
          } else {
            console.error('No session data available to start session');
          }
          break;
          
        case 'session_started':
          console.log('Session started successfully:', message);
          break;
          
        case 'session_error':
          console.error('Session error:', message);
          break;
          
        case 'learning_content':
          console.log('Received learning content:', message);
          break;
          
        default:
          console.log('Unknown message type:', message.type, message);
          break;
      }
    });
  };

  useEffect(() => {
    if (courseId) {
      // Retrieve session data from localStorage
      const storedSession = localStorage.getItem(`session_${courseId}`);
      if (storedSession) {
        try {
          const parsedSession = JSON.parse(storedSession);
          setSessionData(parsedSession);
          console.log('Retrieved session data:', parsedSession);
        } catch (error) {
          console.error('Error parsing session data:', error);
        }
      } else {
        console.error('No session data found for courseId:', courseId);
      }
    }
  }, [courseId]);

  useEffect(() => {
    if (sessionData) {
      // Connect to WebSocket only after session data is loaded
      const websocketUrl = 'ws://localhost:8000/learning-interface';
      setConnectionStatus('connecting');
      
      const ws = new WebSocket(websocketUrl);
      websocketRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected, sending ping...');
        console.log('Current connection status before ping:', connectionStatus);
        // Send ping to verify connection
        ws.send(JSON.stringify({ type: "ping" }));
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected');
        console.log('Close event code:', event.code);
        console.log('Close event reason:', event.reason);
        console.log('Close event wasClean:', event.wasClean);
        setConnectionStatus('disconnected');
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        console.log('Error event details:', error);
        setConnectionStatus('disconnected');
      };

      ws.onmessage = (event) => {
        console.log('WebSocket message received:', event.data);
        console.log('Raw message type:', typeof event.data);
        
        try {
          const data = JSON.parse(event.data);
          console.log('Parsed data:', data);
          
          // Check if data is an array
          if (Array.isArray(data)) {
            console.log('Data is an array with length:', data.length);
            handleWebSocketMessage(data);
          } else {
            // Handle single message (fallback)
            console.log('Data is not an array, treating as single message:', data);
            handleWebSocketMessage([data]);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
          console.error('Raw message data:', event.data);
        }
      };

      // Cleanup function
      return () => {
        if (websocketRef.current) {
          websocketRef.current.close();
        }
      };
    }
  }, [sessionData]);

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return '#22c55e'; // green
      case 'connecting':
        return '#f59e0b'; // yellow
      case 'disconnected':
        return '#ef4444'; // red
      default:
        return '#6b7280'; // gray
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return sessionData?.id ? `Connected (${sessionData.id})` : 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: 'white',
      padding: '20px'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <div className="connection-indicator">
          <div 
            className="connection-status"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              padding: '12px 24px',
              borderRadius: '25px',
              backgroundColor: '#f8f9fa',
              fontSize: '16px',
              fontWeight: '500',
              border: '1px solid #e9ecef',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              color: '#333'
            }}
          >
            <div 
              className="connection-dot"
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: getConnectionStatusColor(),
              }}
            />
            <span>{getConnectionStatusText()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LearningScreen; 