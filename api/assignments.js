export default async function handler(req, res) {
  const token = process.env.CANVAS_API_TOKEN;
  const baseUrl = 'https://bishopkenny.instructure.com/api/v1';

  if (!token) {
    return res.status(500).json({ error: 'CANVAS_API_TOKEN not configured' });
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    // Fetch all courses (active only)
    const coursesRes = await fetch(`${baseUrl}/courses?enrollment_state=active&per_page=50`, { headers });
    if (!coursesRes.ok) throw new Error(`Canvas courses: ${coursesRes.status}`);
    const courses = await coursesRes.json();

    const courseMap = {};
    courses.forEach(c => { courseMap[c.id] = c.name; });

    // Fetch upcoming assignments from all courses in parallel
    const now = new Date().toISOString();
    const assignmentPromises = courses.map(async (course) => {
      try {
        const url = `${baseUrl}/courses/${course.id}/assignments?per_page=50&order_by=due_at&bucket=upcoming`;
        const aRes = await fetch(url, { headers });
        if (!aRes.ok) return [];
        const assignments = await aRes.json();
        return assignments
          .filter(a => a.due_at && !a.submission_types?.includes('not_graded'))
          .map(a => ({
            name: a.name,
            course: course.name,
            courseId: course.id,
            due: a.due_at,
            points: a.points_possible || 0,
            url: a.html_url,
            submitted: a.has_submitted_submissions || false,
            description: a.description ? a.description.replace(/<[^>]*>/g, '').slice(0, 200) : ''
          }));
      } catch {
        return [];
      }
    });

    const results = await Promise.all(assignmentPromises);
    const allAssignments = results
      .flat()
      .filter(a => new Date(a.due) >= new Date(Date.now() - 24 * 60 * 60 * 1000)) // include recently due
      .sort((a, b) => new Date(a.due) - new Date(b.due));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      assignments: allAssignments,
      courses: courses.map(c => ({ id: c.id, name: c.name })),
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
