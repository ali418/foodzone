import React from 'react';
import { Box, Typography, CircularProgress, keyframes } from '@mui/material';

// Define keyframes for animations
const pulse = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const LoadingScreen = () => {
  // Hardcoded colors to ensure it works outside ThemeProvider (e.g. in index.js)
  const colors = {
    primary: '#7A1F3D',
    secondary: '#C5A93C',
    text: '#212529',
    background: '#ffffff'
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        width: '100vw',
        backgroundColor: colors.background,
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          animation: `${pulse} 2s infinite ease-in-out`,
        }}
      >
        <Typography
          variant="h3"
          component="h1"
          sx={{
            fontWeight: 'bold',
            fontFamily: '"Tajawal", "Roboto", "Helvetica", "Arial", sans-serif',
            marginBottom: 0.5,
            letterSpacing: '1px',
            textShadow: '0px 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <span style={{ color: '#1A1A1A' }}>FOOD</span>{' '}
          <span style={{ color: colors.secondary }}>Zone</span>
        </Typography>
        <Typography
          variant="subtitle1"
          sx={{
            color: colors.primary,
            fontWeight: 600,
            letterSpacing: '2px',
            marginBottom: 3,
            fontSize: '0.9rem'
          }}
        >
          RESTAURANT & CAFE
        </Typography>
        
        <CircularProgress 
          size={48}
          thickness={4}
          sx={{
            color: colors.primary,
            marginBottom: 2,
          }}
        />
        
        <Typography
          variant="body1"
          sx={{
            color: colors.text,
            fontFamily: '"Tajawal", "Roboto", "Helvetica", "Arial", sans-serif',
            fontWeight: 500,
            opacity: 0.7,
          }}
        >
          جاري التحميل...
        </Typography>
      </Box>
    </Box>
  );
};

export default LoadingScreen;
