// 1. Define params as a Promise
type Params = Promise<{ projectId: string }>;

// 2. Make the layout function async
export default async function Layout({ 
  children, 
  params 
}: { 
  children: React.ReactNode, 
  params: Params 
}) {
  // 3. Await the params to get the actual ID
  const { projectId } = await params; 

  return (
    <section>
      {children}
    </section>
  );
}
