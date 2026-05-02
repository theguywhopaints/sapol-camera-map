import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: 32,
        height: 32,
        background: '#020617',
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Camera body */}
      <div
        style={{
          width: 22,
          height: 16,
          background: '#1e293b',
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid #f59e0b',
          position: 'relative',
        }}
      >
        {/* Lens */}
        <div
          style={{
            width: 8,
            height: 8,
            background: '#020617',
            borderRadius: '50%',
            border: '2px solid #f59e0b',
          }}
        />
      </div>
    </div>,
    { ...size }
  );
}
