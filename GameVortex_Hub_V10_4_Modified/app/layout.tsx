import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import './styles.css';
export const metadata={title:'GameVortex Hub — عالم الألعاب الخاص بك',description:'GameVortex Hub: منصة ألعاب رقمية مستقلة للألعاب والبطاقات والشحن والمجتمع والمكافآت.',metadataBase:new URL(process.env.APP_ORIGIN||'http://localhost:3000'),openGraph:{title:'GameVortex Hub',description:'عالم الألعاب الخاص بك',type:'website'}};
export const viewport={width:'device-width',initialScale:1,maximumScale:5,themeColor:'#05060b'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body><SiteHeader />{children}<nav className="mobile-bottom-nav"><Link href="/">🏠<span>الرئيسية</span></Link><Link href="/games">🎮<span>الألعاب</span></Link><Link href="/categories">🗂️<span>التصنيفات</span></Link><Link href="/library">❤️<span>المفضلة</span></Link><Link href="/profile/gamer">👤<span>حسابي</span></Link></nav><footer className="footer"><span>GameVortex Hub</span><span>Independent Gaming Universe · لا اعتماد على متاجر خارجية</span></footer></body></html>}
