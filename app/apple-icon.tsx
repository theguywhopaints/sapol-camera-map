import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        background: 'linear-gradient(145deg, #0f172a, #020617)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Camera body */}
      <div
        style={{
          width: 110,
          height: 82,
          background: '#1e293b',
          borderRadius: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '5px solid #f59e0b',
          position: 'relative',
        }}
      >
        {/* Lens outer ring */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: '5px solid #f59e0b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f172a',
          }}
        >
          {/* Lens inner */}
          <div
            style={{
              width: 20,
              height: 20,
              background: '#3b82f6',
              borderRadius: '50%',
            }}
          />
        </div>
        {/* Flash */}
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 14,
            width: 16,
            height: 11,
            background: '#f59e0b',
            borderRadius: 3,
          }}
        />
        {/* Viewfinder bump */}
        <div
          style={{
            position: 'absolute',
            top: -14,
            left: 22,
            width: 22,
            height: 12,
            background: '#1e293b',
            border: '4px solid #f59e0b',
            borderBottom: 'none',
            borderRadius: '4px 4px 0 0',
          }}
        />
      </div>
    </div>,
    { ...size }
  );
}
